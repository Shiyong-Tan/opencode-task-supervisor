// Independently implemented Windows-only laboratory host. No third-party native code.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

class JobHost {
  [StructLayout(LayoutKind.Sequential)] struct Memory { public uint Size, Faults; public UIntPtr PeakWorkingSet, WorkingSet, PeakPaged, Paged, PeakNonpaged, Nonpaged, Pagefile, PeakPagefile; }
  [DllImport("psapi.dll", SetLastError=true)] static extern bool GetProcessMemoryInfo(IntPtr process, ref Memory memory, uint size);
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits Basic; public IO Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; public IO Io; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public int cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public short show, reservedSize; public IntPtr reservedPtr, stdin, stdout, stderr; }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct Security { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Extended info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr info, uint size, out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security attributes, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr env, string cwd, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static IntPtr job, root;
  static uint rootPid;
  static long rootCreated, sequence;
  static bool cancelled, observeOnly;
  static bool treeStopped, launched;
  static readonly Dictionary<uint,IntPtr> memberHandles=new Dictionary<uint,IntPtr>();
  static bool memberLimitExceeded;
  static string execution;
  static JavaScriptSerializer json = new JavaScriptSerializer();
  sealed class Ring {
    public volatile bool Completed;
    readonly object gate = new object(); readonly byte[] buffer = new byte[16384]; int used, next; long total;
    public void Drain(IntPtr handle) {
      try { using(var stream = new FileStream(new SafeFileHandle(handle,true),FileAccess.Read,4096,false)) {
        var chunk=new byte[4096]; int n; while((n=stream.Read(chunk,0,chunk.Length))>0) lock(gate) {
          for(int i=0;i<n;i++){buffer[next]=chunk[i];next=(next+1)%buffer.Length;used=Math.Min(used+1,buffer.Length);} total+=n;
        }
      }} catch(IOException) {} finally { Completed=true; } }
    public object View(){lock(gate){var bytes=new byte[used];for(int i=0;i<used;i++)bytes[i]=buffer[(next-used+i+buffer.Length)%buffer.Length];return new {text=Encoding.UTF8.GetString(bytes), totalBytes=total, retainedBytes=used, truncated=total>used};}}
  }
  static Ring stdout=new Ring(), stderr=new Ring();
  static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
  static string Quote(string s){var b=new StringBuilder("\"");int slashes=0;foreach(char c in s){if(c=='\\'){slashes++;continue;}if(c=='"')b.Append('\\',slashes*2+1);else b.Append('\\',slashes);b.Append(c);slashes=0;}b.Append('\\',slashes*2);return b.Append('"').ToString();}
  static void Start(Dictionary<string,object> req){
    if(job!=IntPtr.Zero)throw new InvalidOperationException("Already started");
    execution=(string)req["executionId"];
    job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
    var limits=new Extended();limits.Basic.Flags=0x2000; // kill on final handle close, no breakaway
    Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))));
    IntPtr list=IntPtr.Zero, jobs=IntPtr.Zero, handles=IntPtr.Zero, outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,inRead=IntPtr.Zero,inWrite=IntPtr.Zero;
    bool initialized=false;
    try {
      var sa=new Security{length=Marshal.SizeOf(typeof(Security)),inherit=1};
      Check(CreatePipe(out outRead,out outWrite,ref sa,0));Check(CreatePipe(out errRead,out errWrite,ref sa,0));Check(CreatePipe(out inRead,out inWrite,ref sa,0));
      Check(SetHandleInformation(outRead,1,0));Check(SetHandleInformation(errRead,1,0));Check(SetHandleInformation(inWrite,1,0));
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);list=Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(list,2,0,ref size));initialized=true;
      jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);
      Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000D),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      handles=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handles,0,inRead);Marshal.WriteIntPtr(handles,IntPtr.Size,outWrite);Marshal.WriteIntPtr(handles,IntPtr.Size*2,errWrite);
      Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
      var si=new StartupEx();si.startup.cb=Marshal.SizeOf(typeof(StartupEx));si.startup.flags=0x100;si.startup.stdin=inRead;si.startup.stdout=outWrite;si.startup.stderr=errWrite;si.attributes=list;
      string exe=Path.GetFullPath((string)req["executable"]);var command=new StringBuilder(Quote(exe));
      foreach(object arg in (System.Collections.IEnumerable)req["args"])command.Append(' ').Append(Quote((string)arg));
      ProcessInfo pi;Check(CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x80000|0x08000000|4,IntPtr.Zero,(string)req["cwd"],ref si,out pi));
      root=pi.process;rootPid=pi.pid;
      try {bool member;long exited,kernel,user;Check(IsProcessInJob(root,job,out member));if(!member)throw new InvalidOperationException("Root outside job");Check(GetProcessTimes(root,out rootCreated,out exited,out kernel,out user));if(observeOnly){limits.Basic.Flags=0;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))));}Check(ResumeThread(pi.thread)!=uint.MaxValue);launched=true;}
      catch {limits.Basic.Flags=0x2000;SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended)));throw;}
      finally {CloseHandle(pi.thread);}
      var a=outRead;var b=errRead;new Thread(()=>stdout.Drain(a)){IsBackground=true}.Start();new Thread(()=>stderr.Drain(b)){IsBackground=true}.Start();outRead=errRead=IntPtr.Zero;
    } finally {
      foreach(var h in new[]{outRead,outWrite,errRead,errWrite,inRead,inWrite})if(h!=IntPtr.Zero)CloseHandle(h);
      if(initialized)DeleteProcThreadAttributeList(list);if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);
    }
  }
  static object Sample(){
    if(root==IntPtr.Zero)throw new InvalidOperationException("Not started");
    uint returned;IntPtr data=Marshal.AllocHGlobal(65536);
    try {
      Check(QueryInformationJobObject(job,8,data,(uint)Marshal.SizeOf(typeof(Accounting)),out returned));var accounting=(Accounting)Marshal.PtrToStructure(data,typeof(Accounting));
      Check(QueryInformationJobObject(job,3,data,65536,out returned));uint count=(uint)Marshal.ReadInt32(data,4);var members=new List<object>();bool unknown=false, memoryKnown=true;ulong workingSet=0;
      if(count>(65536-8)/IntPtr.Size)throw new InvalidOperationException("Member list overflow");
      for(int i=0;i<count;i++){
        uint pid=(uint)Marshal.ReadIntPtr(data,8+i*IntPtr.Size).ToInt64();var h=OpenProcess(0x1000|0x100000,false,pid);
        if(h==IntPtr.Zero){unknown=true;continue;}
        try {bool member;long created,exit,kernel,user;if(!IsProcessInJob(h,job,out member)||!member||!GetProcessTimes(h,out created,out exit,out kernel,out user)){unknown=true;continue;}var memory=new Memory();memory.Size=(uint)Marshal.SizeOf(typeof(Memory));if(GetProcessMemoryInfo(h,ref memory,memory.Size))workingSet+=memory.WorkingSet.ToUInt64();else memoryKnown=false;members.Add(new{pid,creationFileTime=created.ToString(),alive=WaitForSingleObject(h,0)==258,cpu100ns=(kernel+user).ToString()});
          if(!memberHandles.ContainsKey(pid)){if(memberHandles.Count>=256){memberLimitExceeded=true;}else{memberHandles.Add(pid,h);h=IntPtr.Zero;}}
        }
        finally{if(h!=IntPtr.Zero)CloseHandle(h);}
      }
      // Job count is queried again: enumeration races are not a stop certificate.
      Check(QueryInformationJobObject(job,8,data,(uint)Marshal.SizeOf(typeof(Accounting)),out returned));accounting=(Accounting)Marshal.PtrToStructure(data,typeof(Accounting));
      bool rootExited=WaitForSingleObject(root,0)==0;uint exitCode;Check(GetExitCodeProcess(root,out exitCode));
      bool knownMembersStopped=true;foreach(var h in memberHandles.Values)if(WaitForSingleObject(h,0)!=0)knownMembersStopped=false;
      unknown=unknown||memberLimitExceeded;
      bool stopped=accounting.Active==0&&rootExited&&knownMembersStopped&&!unknown&&stdout.Completed&&stderr.Completed;
      treeStopped=accounting.Active==0&&rootExited&&stdout.Completed&&stderr.Completed;
      return new{workingSetBytes=memoryKnown&&!unknown?workingSet.ToString():null,executionId=execution,sequence=++sequence,observedAt=DateTime.UtcNow.ToString("o"),rootPid,rootCreationFileTime=rootCreated.ToString(),rootExited,exitCode=rootExited?(long?)exitCode:null,activeProcesses=accounting.Active,members,cpu100ns=(accounting.User+accounting.Kernel).ToString(),readBytes=accounting.Io.ReadBytes.ToString(),writeBytes=accounting.Io.WriteBytes.ToString(),requestAccepted=cancelled,ownedProcessesStopped=stopped,coverageUnknown=unknown,cancelOutcomeUnknown=cancelled&&(unknown||!stopped),stdout=stdout.View(),stderr=stderr.View(),scope="local-job-members-only; no remote or brokered effects"};
    }finally{Marshal.FreeHGlobal(data);}
  }
  public static int Main(string[] args){
    observeOnly=args.Length==1&&args[0]=="--observe";
    // Laboratory maximum lifetime is independent of the client event loop.
    using(var lease=new Timer(_=>Environment.Exit(72),null,observeOnly?Timeout.Infinite:120000,Timeout.Infinite)){
      try{string line;while((line=Console.ReadLine())!=null){if(line.Length>32768)throw new InvalidOperationException("Request too large");var req=json.Deserialize<Dictionary<string,object>>(line);var op=(string)req["op"];try{
        if(op=="start")Start(req);else {if((string)req["executionId"]!=execution)throw new InvalidOperationException("Execution mismatch");if(op=="cancel"){if(observeOnly)throw new InvalidOperationException("Observation mode cannot cancel");if(!cancelled){Check(TerminateJobObject(job,1223));cancelled=true;}}else if(op=="close")break;else if(op!="sample")throw new InvalidOperationException("Unknown operation");}
        Console.WriteLine(json.Serialize(new{id=req["id"],ok=true,result=Sample()}));
      }catch(Exception e){Console.WriteLine(json.Serialize(new{id=req["id"],ok=false,error=e.GetType().Name,win32=e is Win32Exception?((Win32Exception)e).NativeErrorCode:0}));if(op=="start")return 1;}}
      return 0;}catch{return 2;}finally{
        // Keep output pipes drained after observer disconnect; no kill-on-close in observation mode.
        if(observeOnly&&launched)while(!treeStopped){try{Sample();}catch{}Thread.Sleep(1000);}
        if(job!=IntPtr.Zero)CloseHandle(job);foreach(var h in memberHandles.Values)CloseHandle(h);if(root!=IntPtr.Zero)CloseHandle(root);}
    }
  }
}

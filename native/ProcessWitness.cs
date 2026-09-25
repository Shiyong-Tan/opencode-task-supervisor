// Test-only independent witness: observes only explicitly supplied PID + creation-time pairs.
// Keeps OS handles open across helper death. Never scans names or terminates processes.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class ProcessWitness {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long created,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Main(){var json=new JavaScriptSerializer();var handles=new List<IntPtr>();var identities=new List<object>();
    try{var request=json.Deserialize<Dictionary<string,object>>(Console.ReadLine());
      foreach(Dictionary<string,object> member in (IEnumerable)request["members"]){
        uint pid=Convert.ToUInt32(member["pid"]);var h=OpenProcess(0x1000|0x100000,false,pid);if(h==IntPtr.Zero)throw new Exception("Cannot open expected member");handles.Add(h);
        long created,exit,kernel,user;if(!GetProcessTimes(h,out created,out exit,out kernel,out user)||created.ToString()!=(string)member["creationFileTime"])throw new Exception("OS identity mismatch");
        identities.Add(new{pid,creationFileTime=created.ToString()});
      }
      Console.WriteLine(json.Serialize(new{ready=true,identities}));
      if(Console.ReadLine()!="check")return 2;
      bool stopped=true;foreach(var h in handles)if(WaitForSingleObject(h,3000)!=0)stopped=false;
      Console.WriteLine(json.Serialize(new{stopped,identities,scope="exact pre-opened handles of finite fixture members; not arbitrary descendants"}));return stopped?0:1;
    }catch{Console.WriteLine("{\"ready\":false,\"error\":\"Identity/observation failed\"}");return 1;}
    finally{foreach(var h in handles)CloseHandle(h);}
  }
}

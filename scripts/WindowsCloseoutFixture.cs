using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
class WindowsCloseoutFixture {
  static Process Child(string release) {
    return Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
      "member \""+release+"\" 0"){UseShellExecute=false,CreateNoWindow=true});
  }
  static int Main(string[] args) {
    string mode=args[0],release=args[1];int code=int.Parse(args[2]);
    if(mode=="member"){
      File.WriteAllText(release+".ready",Process.GetCurrentProcess().Id.ToString());
      var deadline=Stopwatch.StartNew();while(deadline.ElapsedMilliseconds<10000){
        try{if(File.ReadAllText(release)==Process.GetCurrentProcess().Id.ToString())return 0;}catch(IOException){}
        Thread.Sleep(5);
      }return 91;
    }
    if(mode=="root-exit"){Child(release);Thread.Sleep(150);Environment.Exit(code);}
    if(mode=="churn"){
      for(int i=0;i<280;i++)using(var child=Child(release)){child.WaitForExit();if(child.ExitCode!=0)return 92;}
      Console.WriteLine("FIXTURE COMPLETE");return code;
    }
    return 93;
  }
}

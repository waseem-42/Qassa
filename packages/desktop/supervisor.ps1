$ErrorActionPreference = 'Stop'
# A Windows Job Object closes the whole tree even if the server or Electron crashes.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QassaJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public IO io; public UIntPtr process,job,peakProcess,peakJob; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Own(IntPtr process) {
    var job=CreateJobObject(IntPtr.Zero,null); var l=new Limits(); l.basic.flags=0x2000;
    int n=Marshal.SizeOf(l); var p=Marshal.AllocHGlobal(n);
    try { Marshal.StructureToPtr(l,p,false); if(!SetInformationJobObject(job,9,p,(uint)n)||!AssignProcessToJobObject(job,process)) throw new System.ComponentModel.Win32Exception(); return job; }
    catch { CloseHandle(job); throw; } finally { Marshal.FreeHGlobal(p); }
  }
}
'@
$serverProcess = $null
$jobHandle = [IntPtr]::Zero
try {
  $parentProcess = Get-Process -Id ([int]$env:EDIT_PARENT_PID)
  $serverProcess = Start-Process -FilePath $env:EDIT_NODE_EXE -ArgumentList ('"{0}"' -f $env:EDIT_SERVER_SCRIPT) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:EDIT_LOG_DIR ($env:EDIT_SERVER_LOG + '.log')) -RedirectStandardError (Join-Path $env:EDIT_LOG_DIR ($env:EDIT_SERVER_LOG + '-error.log'))
  $jobHandle = [QassaJob]::Own($serverProcess.Handle)
  while (-not $serverProcess.HasExited -and -not $parentProcess.HasExited) { Start-Sleep -Milliseconds 250; $serverProcess.Refresh(); $parentProcess.Refresh() }
} finally {
  if ($jobHandle -ne [IntPtr]::Zero) { [void][QassaJob]::CloseHandle($jobHandle) }
  elseif ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
}

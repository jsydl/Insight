// WASAPI Loopback Capture - captures system audio output (what plays through speakers)
// Usage: wasapi-loopback.exe <output.wav> <durationMs>
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;

class WasapiLoopback
{
    // COM interop for Windows Core Audio API
    [DllImport("ole32.dll")]
    static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);
    [DllImport("ole32.dll")]
    static extern void CoUninitialize();

    // MMDeviceEnumerator CLSID
    static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    static readonly Guid IID_IMMDeviceEnumerator = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
    static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    const int AUDCLNT_SHAREMODE_SHARED = 0;
    const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const int STGM_READ = 0;
    const int eRender = 0;
    const int eConsole = 0;

    // WAVEFORMATEX structure
    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    // IMMDeviceEnumerator
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, uint dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    }

    // IMMDevice
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    // IAudioClient
    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        int Initialize(int ShareMode, int StreamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr AudioSessionGuid);
        int GetBufferSize(out uint pNumBufferFrames);
        int GetStreamLatency(out long phnsLatency);
        int GetCurrentPadding(out uint pNumPaddingFrames);
        int IsFormatSupported(int ShareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
        int GetMixFormat(out IntPtr ppDeviceFormat);
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    // IAudioCaptureClient
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr ppData, out uint pNumFramesAvailable, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        int ReleaseBuffer(uint NumFramesRead);
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: wasapi-loopback.exe <output.wav> <durationMs>");
            return 1;
        }

        string outputPath = args[0];
        int durationMs = int.Parse(args[1]);

        int hr = CoInitializeEx(IntPtr.Zero, 0);

        try
        {
            // Get device enumerator
            var enumeratorType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
            var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);

            // Get default render endpoint (speakers/headphones)
            IntPtr devicePtr;
            hr = enumerator.GetDefaultAudioEndpoint(eRender, eConsole, out devicePtr);
            if (hr != 0) { Console.Error.WriteLine("Failed to get default audio endpoint: 0x{0:X}", hr); return 1; }
            var device = (IMMDevice)Marshal.GetObjectForIUnknown(devicePtr);

            // Activate IAudioClient
            object audioClientObj;
            hr = device.Activate(IID_IAudioClient, 0x17 /* CLSCTX_ALL */, IntPtr.Zero, out audioClientObj);
            if (hr != 0) { Console.Error.WriteLine("Failed to activate audio client: 0x{0:X}", hr); return 1; }
            var audioClient = (IAudioClient)audioClientObj;

            // Get mix format
            IntPtr mixFormatPtr;
            hr = audioClient.GetMixFormat(out mixFormatPtr);
            if (hr != 0) { Console.Error.WriteLine("Failed to get mix format: 0x{0:X}", hr); return 1; }
            var mixFormat = Marshal.PtrToStructure<WAVEFORMATEX>(mixFormatPtr);

            Console.Error.WriteLine("Mix format: {0}ch {1}Hz {2}bit tag={3}",
                mixFormat.nChannels, mixFormat.nSamplesPerSec, mixFormat.wBitsPerSample, mixFormat.wFormatTag);

            // Initialize in loopback mode
            long bufferDuration = 10000000; // 1 second in 100ns units
            hr = audioClient.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                bufferDuration,
                0,
                mixFormatPtr,
                IntPtr.Zero
            );
            if (hr != 0) { Console.Error.WriteLine("Failed to initialize audio client: 0x{0:X}", hr); return 1; }

            // Get capture client
            object captureClientObj;
            hr = audioClient.GetService(IID_IAudioCaptureClient, out captureClientObj);
            if (hr != 0) { Console.Error.WriteLine("Failed to get capture client: 0x{0:X}", hr); return 1; }
            var captureClient = (IAudioCaptureClient)captureClientObj;

            // Start capturing
            hr = audioClient.Start();
            if (hr != 0) { Console.Error.WriteLine("Failed to start capture: 0x{0:X}", hr); return 1; }

            var allBytes = new List<byte>();
            int elapsed = 0;
            int sleepMs = 20;

            while (elapsed < durationMs)
            {
                Thread.Sleep(sleepMs);
                elapsed += sleepMs;

                uint packetSize;
                captureClient.GetNextPacketSize(out packetSize);

                while (packetSize > 0)
                {
                    IntPtr dataPtr;
                    uint numFrames;
                    uint flags;
                    ulong devPos, qpcPos;

                    hr = captureClient.GetBuffer(out dataPtr, out numFrames, out flags, out devPos, out qpcPos);
                    if (hr != 0) break;

                    int byteCount = (int)(numFrames * mixFormat.nBlockAlign);

                    // Only copy if not silent flag (flags & 2 == AUDCLNT_BUFFERFLAGS_SILENT)
                    if ((flags & 2) == 0)
                    {
                        byte[] buf = new byte[byteCount];
                        Marshal.Copy(dataPtr, buf, 0, byteCount);
                        allBytes.AddRange(buf);
                    }
                    else
                    {
                        // Write silence bytes
                        allBytes.AddRange(new byte[byteCount]);
                    }

                    captureClient.ReleaseBuffer(numFrames);
                    captureClient.GetNextPacketSize(out packetSize);
                }
            }

            audioClient.Stop();

            // Write WAV file with IEEE float format (tag=3)
            // WASAPI loopback always gives us 32-bit float data regardless of
            // WAVEFORMATEXTENSIBLE wrapper, so we write tag=3 which ffmpeg understands.
            using (var fs = new FileStream(outputPath, FileMode.Create))
            using (var bw = new BinaryWriter(fs))
            {
                int dataSize = allBytes.Count;
                ushort outChannels = mixFormat.nChannels;
                uint outRate = mixFormat.nSamplesPerSec;
                ushort outBits = 32; // always 32-bit float from WASAPI
                ushort outBlockAlign = (ushort)(outChannels * (outBits / 8));
                uint outByteRate = outRate * (uint)outBlockAlign;
                ushort outTag = 3; // IEEE_FLOAT

                // RIFF header
                bw.Write(new byte[] { 0x52, 0x49, 0x46, 0x46 }); // "RIFF"
                bw.Write(36 + dataSize);
                bw.Write(new byte[] { 0x57, 0x41, 0x56, 0x45 }); // "WAVE"

                // fmt chunk (16 bytes, standard)
                bw.Write(new byte[] { 0x66, 0x6D, 0x74, 0x20 }); // "fmt "
                bw.Write((int)16);
                bw.Write(outTag);
                bw.Write(outChannels);
                bw.Write(outRate);
                bw.Write(outByteRate);
                bw.Write(outBlockAlign);
                bw.Write(outBits);

                // data chunk
                bw.Write(new byte[] { 0x64, 0x61, 0x74, 0x61 }); // "data"
                bw.Write(dataSize);
                bw.Write(allBytes.ToArray());
            }

            Console.Error.WriteLine("Captured {0} bytes of audio data", allBytes.Count);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error: " + ex.Message);
            return 1;
        }
        finally
        {
            CoUninitialize();
        }
    }
}

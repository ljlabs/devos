import { useState, useEffect } from "react";
import { History } from "lucide-react";

export default function LogsRoute() {
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/logs");
    es.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        if (log.thread_id) {
          setGlobalLogs((prev) => [`[${new Date(log.timestamp).toLocaleTimeString()}] [${log.component}:${log.thread_id.slice(0, 12)}] ${log.message}`, ...prev]);
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden p-4 md:p-8 animate-fadeIn">
      <div className="max-w-4xl w-full mx-auto space-y-4 md:space-y-6 flex flex-col h-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 select-none pb-4 border-b border-white/5 justify-between shrink-0">
          <div className="flex items-center gap-2">
            <History className="text-emerald-400 flex-shrink-0" size={20} />
            <h2 className="font-sans font-bold text-base sm:text-lg md:text-xl text-white truncate">Global DevOS Activity Audit Trail</h2>
          </div>
          <button onClick={() => setGlobalLogs([])} className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer whitespace-nowrap">Clear Log History</button>
        </div>

        <div className="flex-1 bg-black/40 rounded-lg md:rounded-xl border border-white/5 p-4 md:p-6 font-mono text-xs text-slate-400 space-y-2 overflow-y-auto custom-scrollbar shadow-2xl">
          {globalLogs.length === 0 ? (
            <p className="text-slate-600 italic text-center py-12 font-sans">No diagnostic activities logged in current session.</p>
          ) : (
            globalLogs.map((log, i) => (
              <p key={i} className="leading-relaxed border-b border-white/5 pb-1.5 last:border-none text-slate-300">
                <span className="text-emerald-500 font-bold mr-2">&gt;&gt;</span>
                <span className="break-words">{log}</span>
              </p>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

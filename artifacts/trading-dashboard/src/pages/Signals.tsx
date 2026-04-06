import { useState } from "react";
import { useListSignals, getListSignalsQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow, format } from "date-fns";
import { motion } from "framer-motion";
import { Activity, Clock, CheckCircle2, CircleDashed, BarChart2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

export function Signals() {
  const [filter, setFilter] = useState<boolean | undefined>(undefined);
  const params = { limit: 50, processed: filter };
  
  const { data, isLoading } = useListSignals(
    params,
    { query: { queryKey: getListSignalsQueryKey(params), refetchInterval: 5000 } }
  );

  const signals = data?.signals || [];
  const total = data?.total || 0;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-1"
        >
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground flex items-center gap-3">
            Signal Feed
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
          </h1>
          <p className="text-muted-foreground text-lg">Monitoring TradingView alerts in real-time.</p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex bg-black/40 border border-white/10 rounded-xl p-1 backdrop-blur-md"
        >
          <button
            onClick={() => setFilter(undefined)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              filter === undefined ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:text-white"
            )}
          >
            All ({total})
          </button>
          <button
            onClick={() => setFilter(false)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              filter === false ? "bg-amber-500/20 text-amber-400 shadow-sm" : "text-muted-foreground hover:text-white"
            )}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter(true)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              filter === true ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:text-white"
            )}
          >
            Processed
          </button>
        </motion.div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-panel rounded-2xl overflow-hidden"
      >
        {isLoading && signals.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <Activity className="w-8 h-8 animate-pulse text-primary" />
            <p>Loading signals...</p>
          </div>
        ) : signals.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
              <BarChart2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">No Signals Found</h3>
            <p className="text-muted-foreground max-w-md">
              Your trading feed is currently empty. Make sure your TradingView webhooks are correctly pointing to the server.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-sm uppercase tracking-wider text-muted-foreground">
                  <th className="py-4 px-6 font-medium">Symbol</th>
                  <th className="py-4 px-6 font-medium">Action</th>
                  <th className="py-4 px-6 font-medium">Price</th>
                  <th className="py-4 px-6 font-medium">Status</th>
                  <th className="py-4 px-6 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {signals.map((signal, idx) => (
                  <motion.tr 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    key={signal.id} 
                    className="hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                          {signal.symbol.substring(0, 1)}
                        </div>
                        <span className="font-mono font-semibold text-lg">{signal.symbol}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border",
                        signal.action === "BUY" 
                          ? "bg-success/10 text-success border-success/20" 
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      )}>
                        {signal.action}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span className="font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                        {formatCurrency(signal.price)}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {signal.processed ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                          <span>Processed</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                          <CircleDashed className="w-4 h-4 animate-spin-slow" />
                          <span>Pending Ext...</span>
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div
                        className="flex items-center justify-end gap-2 text-muted-foreground text-sm"
                        title={format(new Date(signal.createdAt), "yyyy-MM-dd HH:mm:ss")}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

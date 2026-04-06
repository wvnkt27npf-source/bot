import { useState } from "react";
import { useListSymbols } from "@workspace/api-client-react";
import { useCreateSymbol, useDeleteSymbol } from "@/hooks/use-trading";
import { motion } from "framer-motion";
import { List, Plus, Trash2, ExternalLink, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export function Symbols() {
  const { data: symbols = [], isLoading } = useListSymbols();
  const { mutate: createSymbol, isPending: isCreating } = useCreateSymbol();
  const { mutate: deleteSymbol, isPending: isDeleting } = useDeleteSymbol();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [xmUrl, setXmUrl] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !xmUrl) return;

    createSymbol(
      { data: { name, xmUrl } },
      {
        onSuccess: () => {
          toast({ title: "Symbol added", description: `${name} has been configured.` });
          setName("");
          setXmUrl("");
        },
        onError: (err: Error) => {
          toast({ 
            title: "Failed to add symbol", 
            description: err.message || "Something went wrong", 
            variant: "destructive" 
          });
        }
      }
    );
  };

  const handleDelete = (id: number, symbolName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${symbolName}?`)) return;
    
    deleteSymbol(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Symbol removed", description: `${symbolName} has been deleted.` });
        }
      }
    );
  };

  return (
    <div className="space-y-8 pb-10">
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-1"
      >
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground flex items-center gap-3">
          Symbol Registry
        </h1>
        <p className="text-muted-foreground text-lg">Manage supported trading pairs and their XM broker URLs.</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Add Symbol Form */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-1"
        >
          <div className="glass-panel p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-primary/20"></div>
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add New Symbol
            </h2>
            
            <form onSubmit={handleAdd} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Pair Name (e.g. BTCUSD)</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="BTCUSD"
                  className="w-full glass-input rounded-xl px-4 py-3 text-foreground font-mono placeholder:text-muted-foreground/50"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">XM Broker URL</label>
                <input 
                  type="url" 
                  value={xmUrl}
                  onChange={(e) => setXmUrl(e.target.value)}
                  placeholder="https://my.xm.com/symbol-info/..."
                  className="w-full glass-input rounded-xl px-4 py-3 text-foreground font-mono text-sm placeholder:text-muted-foreground/50"
                  required
                />
              </div>
              <button 
                type="submit"
                disabled={isCreating}
                className="w-full py-3 px-4 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCreating ? "Adding..." : "Register Symbol"}
              </button>
            </form>

            <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/20 flex gap-3 text-sm text-primary/90">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>The URL must point exactly to the XM symbol-info page where the One Click Order button exists.</p>
            </div>
          </div>
        </motion.div>

        {/* Symbol List */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 glass-panel rounded-2xl overflow-hidden flex flex-col"
        >
          <div className="p-6 border-b border-white/10 bg-white/[0.02]">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <List className="w-5 h-5 text-primary" />
              Active Symbols ({symbols.length})
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto max-h-[600px] p-2">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading symbols...</div>
            ) : symbols.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No symbols configured yet.</div>
            ) : (
              <div className="grid gap-2">
                {symbols.map((sym, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    key={sym.id}
                    className="flex items-center justify-between p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center font-bold text-primary shadow-inner">
                        {sym.name.substring(0, 2)}
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground font-mono text-lg leading-none">{sym.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            Added {formatDistanceToNow(new Date(sym.createdAt))} ago
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <a 
                        href={sym.xmUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title="Open XM Link"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button 
                        onClick={() => handleDelete(sym.id, sym.name)}
                        disabled={isDeleting}
                        className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                        title="Delete Symbol"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

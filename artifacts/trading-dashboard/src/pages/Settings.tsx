import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetSettings } from "@workspace/api-client-react";
import { useUpdateSettings } from "@/hooks/use-trading";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Link2, Download, Terminal, Check, Copy, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const { mutate: updateSettings, isPending: isSaving } = useUpdateSettings();
  const { toast } = useToast();

  const [tpStr, setTpStr] = useState<string>("2");
  const [slStr, setSlStr] = useState<string>("2");
  const [automationEnabled, setAutomationEnabled] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);

  // Sync state when data loads
  useEffect(() => {
    if (settings) {
      setTpStr(String(settings.tpAmount));
      setSlStr(String(settings.slAmount));
      setAutomationEnabled(settings.automationEnabled);
    }
  }, [settings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedTp = parseFloat(tpStr);
    const parsedSl = parseFloat(slStr);
    const safeTp = Number.isFinite(parsedTp) && parsedTp >= 0 ? parsedTp : settings?.tpAmount ?? 2;
    const safeSl = Number.isFinite(parsedSl) && parsedSl >= 0 ? parsedSl : settings?.slAmount ?? 2;
    updateSettings(
      { data: { tpAmount: safeTp, slAmount: safeSl, automationEnabled } },
      {
        onSuccess: () => {
          toast({ title: "Settings Saved", description: "Trading automation settings updated successfully." });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
        }
      }
    );
  };

  // Fetch the full webhook URL (with auth token) from the server
  const { data: webhookInfo } = useQuery<{ url: string | null; configured: boolean }>({
    queryKey: ["webhook-url"],
    queryFn: () => fetch("/api/webhook-url").then((r) => r.json()),
    staleTime: 60_000,
  });
  const webhookUrl = webhookInfo?.url ?? "";
  
  const handleCopy = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied!", description: "Webhook URL (with token) copied to clipboard." });
  };

  if (isLoading) return <div className="p-8 text-muted-foreground text-center">Loading settings...</div>;

  return (
    <div className="space-y-8 pb-10">
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-1"
      >
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground flex items-center gap-3">
          Configuration
        </h1>
        <p className="text-muted-foreground text-lg">Manage trading logic, webhooks, and extension setup.</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Core Trading Settings */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel p-6 rounded-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary" />
            Trading Parameters
          </h2>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Take Profit ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">$</span>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0"
                    value={tpStr}
                    onChange={(e) => setTpStr(e.target.value)}
                    className="w-full glass-input rounded-xl pl-8 pr-4 py-3 text-foreground font-mono text-lg"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Stop Loss ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">$</span>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0"
                    value={slStr}
                    onChange={(e) => setSlStr(e.target.value)}
                    className="w-full glass-input rounded-xl pl-8 pr-4 py-3 text-foreground font-mono text-lg"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-foreground">Master Automation Switch</h3>
                <p className="text-sm text-muted-foreground">Allow Chrome extension to place trades.</p>
              </div>
              <button
                type="button"
                onClick={() => setAutomationEnabled(!automationEnabled)}
                className={cn(
                  "relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
                  automationEnabled ? "bg-primary" : "bg-white/20"
                )}
              >
                <span className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white transition duration-300",
                  automationEnabled ? "translate-x-8 shadow-[0_0_10px_rgba(255,255,255,0.5)]" : "translate-x-1"
                )} />
              </button>
            </div>

            <button 
              type="submit"
              disabled={isSaving}
              className="w-full py-3 px-4 rounded-xl font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Preferences"}
            </button>
          </form>
        </motion.div>

        {/* Webhook Settings */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-6 rounded-2xl"
        >
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            TradingView Integration
          </h2>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Webhook URL <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">includes auth token</span>
              </label>
              {webhookInfo && !webhookInfo.configured && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  WEBHOOK_SECRET is not set on the server — webhook authentication is disabled.
                </div>
              )}
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={webhookUrl || (webhookInfo === undefined ? "Loading..." : "Not configured")}
                  className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-muted-foreground"
                />
                <button 
                  onClick={handleCopy}
                  disabled={!webhookUrl}
                  className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors shrink-0 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-foreground" />}
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium text-muted-foreground">Alert Message Payload (JSON)</label>
              <div className="bg-black/80 border border-white/10 rounded-xl p-4 font-mono text-sm text-primary/80 overflow-x-auto whitespace-pre">
{`{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}}
}`}
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              In TradingView, create an alert on your ALGOX indicator. Go to Notifications tab, check "Webhook URL" and paste the link above. In the Message box, paste the JSON payload exactly as shown.
            </p>
          </div>
        </motion.div>

        {/* Extension Installation */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-panel p-6 rounded-2xl lg:col-span-2"
        >
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Chrome Extension Setup
          </h2>
          
          <div className="grid md:grid-cols-4 gap-6">
            <div className="md:col-span-1">
              <div className="w-full aspect-square bg-primary/5 border border-primary/20 rounded-2xl flex flex-col items-center justify-center p-4 text-center gap-4 hover:bg-primary/10 transition-colors">
                <Terminal className="w-12 h-12 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">AlgoX Executer</h3>
                  <p className="text-xs text-muted-foreground mt-1">v1.0.0 (Unpacked)</p>
                </div>
                <a
                  href={`${import.meta.env.BASE_URL}chrome-extension.zip`}
                  download="algox-trader-extension.zip"
                  className="px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded-lg text-sm font-semibold hover:bg-primary hover:text-white transition-colors w-full text-center"
                >
                  Download ZIP
                </a>
              </div>
            </div>
            
            <div className="md:col-span-3">
              <ol className="space-y-4 list-decimal list-inside text-muted-foreground ml-4 marker:text-primary marker:font-bold">
                <li className="pl-2">
                  <strong className="text-foreground">Download & Extract</strong>: Download the extension ZIP file and extract it to a folder on your computer.
                </li>
                <li className="pl-2">
                  <strong className="text-foreground">Open Chrome Extensions</strong>: Navigate to <code className="bg-black/50 px-2 py-1 rounded text-primary text-sm">chrome://extensions</code> in your browser.
                </li>
                <li className="pl-2">
                  <strong className="text-foreground">Enable Developer Mode</strong>: Toggle "Developer mode" on in the top right corner of the extensions page.
                </li>
                <li className="pl-2">
                  <strong className="text-foreground">Load Unpacked</strong>: Click the "Load unpacked" button and select the folder where you extracted the extension.
                </li>
                <li className="pl-2">
                  <strong className="text-foreground">Final Step</strong>: Pin the extension to your toolbar, click it to set your server URL to <code className="bg-black/50 px-2 py-1 rounded text-primary text-sm">{window.location.origin}</code>, and ensure you are logged into your XM broker account.
                </li>
              </ol>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

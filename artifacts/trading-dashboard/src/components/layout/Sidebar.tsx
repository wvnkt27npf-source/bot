import { Link, useLocation } from "wouter";
import { Activity, List, Settings, Terminal, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "@/context/settings-context";

export function Sidebar() {
  const [location] = useLocation();
  const { isAutomationActive } = useSettingsContext();

  const navItems = [
    { href: "/", label: "Signals", icon: Activity },
    { href: "/symbols", label: "Symbols", icon: List },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 h-screen border-r border-white/5 bg-card/30 backdrop-blur-md flex flex-col hidden md:flex shrink-0">
      <div className="p-6 flex items-center gap-3 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
          <Terminal className="w-4 h-4 text-primary" />
        </div>
        <h1 className="font-semibold tracking-wide text-foreground">AlgoX Trader</h1>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20" 
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
              )}
            >
              <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "opacity-70")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-6 border-t border-white/5">
        <div className="glass-panel p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className={cn(
              "w-4 h-4", 
              isAutomationActive ? "text-success animate-pulse" : "text-destructive"
            )} />
            <span className="text-sm font-medium text-muted-foreground">Automation</span>
          </div>
          <div className={cn(
            "text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md border",
            isAutomationActive 
              ? "bg-success/10 text-success border-success/20 text-glow" 
              : "bg-destructive/10 text-destructive border-destructive/20"
          )}>
            {isAutomationActive ? "Active" : "Paused"}
          </div>
        </div>
      </div>
    </aside>
  );
}

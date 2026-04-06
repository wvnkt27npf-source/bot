import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Activity, List, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "@/context/settings-context";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { isAutomationActive } = useSettingsContext();

  const navItems = [
    { href: "/", label: "Signals", icon: Activity },
    { href: "/symbols", label: "Symbols", icon: List },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header Bar — visible on all screen sizes */}
        <header className="h-14 border-b border-white/5 bg-card/50 backdrop-blur-md flex items-center justify-between px-4 md:px-8 z-20 shrink-0">
          {/* Mobile logo */}
          <div className="md:hidden flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center border border-primary/30">
              <Activity className="w-3 h-3 text-primary" />
            </div>
            <span className="font-semibold text-sm">AlgoX</span>
          </div>

          {/* Desktop spacer */}
          <div className="hidden md:block" />

          {/* Right: automation status pill */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">Automation</span>
            <div className={cn(
              "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border",
              isAutomationActive
                ? "bg-success/10 text-success border-success/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                isAutomationActive ? "bg-success animate-pulse" : "bg-destructive"
              )} />
              {isAutomationActive ? "ON" : "OFF"}
            </div>
          </div>
        </header>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-white/5 bg-card/90 backdrop-blur-md flex items-center justify-around px-4 z-30">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 pb-20 md:pb-10 z-10">
          <div className="max-w-6xl mx-auto h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

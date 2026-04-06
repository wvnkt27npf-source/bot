import { Link } from "wouter";
import { Activity, AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center">
            <AlertTriangle className="w-9 h-9 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-5xl font-bold text-foreground">404</h1>
          <p className="text-xl font-semibold text-foreground">Page not found</p>
          <p className="text-muted-foreground text-sm">
            The page you are looking for does not exist.
          </p>
        </div>
        <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors text-sm font-medium">
          <Activity className="w-4 h-4" />
          Back to Signal Feed
        </Link>
      </div>
    </div>
  );
}

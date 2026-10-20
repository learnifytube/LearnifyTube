import React from "react";
import { Toaster } from "@/components/ui/toaster";

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderNav } from "@/components/HeaderNav";
import { BookPlayerBar } from "@/components/book-player/BookPlayerBar";

export default function BaseLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        {/* Left sidebar */}
        <AppSidebar />

        {/* Main content */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-primary/5 to-accent/5 dark:from-primary/10 dark:to-accent/10">
          <HeaderNav />
          <div className="flex-1 overflow-auto">{children}</div>
          <BookPlayerBar />
        </main>

        <Toaster />
      </div>
    </SidebarProvider>
  );
}

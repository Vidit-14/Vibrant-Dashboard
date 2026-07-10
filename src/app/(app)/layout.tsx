import Sidebar from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <div className="mx-auto max-w-[1500px] px-6 py-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

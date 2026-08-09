export function MomentsShell({
  toolbar,
  children,
}: {
  toolbar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background px-4 pt-24 pb-16 text-foreground md:pt-12 md:pb-28">
      <div className="mx-auto w-full max-w-3xl">
        <main>{children}</main>
      </div>
      {toolbar}
    </div>
  );
}

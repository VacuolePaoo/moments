export function MomentsShell({
  actions,
  children,
}: {
  actions: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background px-4 pt-12 pb-16 text-foreground">
      <div className="mx-auto w-full max-w-3xl lg:max-[1183px]:max-w-[calc(100vw-26rem)]">
        <aside className="mb-12 flex items-center justify-between gap-4 lg:fixed lg:top-12 lg:left-[calc(50%_-_min(24rem,(100vw_-_26rem)/2)_-_13rem)] lg:mb-0 lg:w-44 lg:flex-col lg:items-stretch">
          {actions}
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}

import { cn } from "@/lib/utils";

export function PageTitle({ className, children }: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "mb-12 text-[1.602rem] leading-[1.5] font-semibold",
        className,
      )}
    >
      {children}
    </h1>
  );
}

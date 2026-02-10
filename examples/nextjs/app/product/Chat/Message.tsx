import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function Message({
  authorId,
  authorName,
  viewerId,
  children,
}: {
  authorId: string;
  authorName: string;
  viewerId: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-col text-sm",
        authorId === viewerId ? "items-end self-end" : "items-start self-start",
      )}
    >
      <div className="mb-1 text-sm font-medium">{authorName}</div>
      <p
        className={cn(
          "rounded-xl bg-muted px-3 py-2",
          authorId === viewerId ? "rounded-tr-none" : "rounded-tl-none",
        )}
      >
        {children}
      </p>
    </li>
  );
}

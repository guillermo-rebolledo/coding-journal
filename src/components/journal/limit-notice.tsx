import { StateBlock } from "@/components/journal/state-block";

/**
 * The one way this product tells you it refused a request — pattern 11 and the
 * limit row of the state gallery (`docs/design/Coding Journal look and feel.html`,
 * frames 1n and 1o).
 *
 * Every limit sentence is written the same way: what happened, what still
 * works, and when it returns. The first sentence takes the notice's title slot
 * and the rest becomes the body, so a cooldown, a request budget and a
 * provider outage all land in the same slot, in the same type role, with the
 * recorded journal beside them left entirely alone.
 */
export function LimitNotice({
  message,
  tone = "neutral",
  className,
}: {
  message: string;
  tone?: "neutral" | "warning";
  className?: string;
}) {
  const boundary = message.indexOf(". ");
  const title = boundary === -1 ? message : message.slice(0, boundary + 1);
  const detail = boundary === -1 ? null : message.slice(boundary + 2);

  return (
    <StateBlock
      role="status"
      title={title}
      tone={tone}
      {...(className ? { className } : {})}
    >
      {detail}
    </StateBlock>
  );
}

import { Fragment } from "react";

export function RichMessage({
  body,
  mentionLabels,
}: {
  body: string;
  mentionLabels?: Record<string, string>;
}) {
  return <>{renderInline(body, mentionLabels ?? {})}</>;
}

function renderInline(value: string, mentionLabels: Record<string, string>) {
  const pattern =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|<@&?[a-zA-Z0-9_-]+>|https?:\/\/[^\s<]+|\n)/g;
  const parts = value.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (part === "\n") return <br key={index} />;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={index}>{part.slice(1, -1)}</em>;
    if (/^<@&?[a-zA-Z0-9_-]+>$/.test(part)) {
      const role = part.startsWith("<@&");
      const id = part.slice(role ? 3 : 2, -1);
      return (
        <span className="message-mention" key={index}>
          @{mentionLabels[`${role ? "role" : "user"}:${id}`] ?? "menção"}
        </span>
      );
    }
    if (/^https?:\/\//.test(part))
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer noopener">
          {part}
        </a>
      );
    return <Fragment key={index}>{part}</Fragment>;
  });
}

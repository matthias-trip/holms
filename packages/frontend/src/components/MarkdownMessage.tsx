import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: "var(--white)" }}>
      {children}
    </strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1 py-0.5 rounded text-[12px]"
        style={{
          background: "var(--graphite)",
          fontFamily: "var(--font-mono)",
          color: "var(--glow-dim)",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      className="rounded-lg p-3 my-2 overflow-x-auto text-[12px]"
      style={{
        background: "var(--slate)",
        border: "1px solid var(--graphite)",
        fontFamily: "var(--font-mono)",
        color: "var(--frost)",
      }}
    >
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: "var(--glow)" }}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => (
    <h1 className="text-[16px] font-semibold mb-2 mt-3 first:mt-0" style={{ color: "var(--white)" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold mb-1.5 mt-2.5 first:mt-0" style={{ color: "var(--white)" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] font-medium mb-1 mt-2 first:mt-0" style={{ color: "var(--white)" }}>
      {children}
    </h3>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className="pl-3 my-2"
      style={{
        borderLeft: "2px solid var(--glow-border)",
        color: "var(--steel)",
      }}
    >
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table
        className="w-full text-[12px]"
        style={{ borderCollapse: "collapse" }}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      className="px-2 py-1 text-left font-medium"
      style={{
        borderBottom: "1px solid var(--graphite)",
        color: "var(--white)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-2 py-1"
      style={{ borderBottom: "1px solid var(--graphite)" }}
    >
      {children}
    </td>
  ),
  hr: () => <hr className="my-3" style={{ borderColor: "var(--graphite)" }} />,
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

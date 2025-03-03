import { Markdown, MarkdownProps } from "@lobehub/ui";
import { useControls, useCreateStore } from "@lobehub/ui/storybook";
import { LinkPreview } from "./ui/link-preview";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export default function ChatMarkdown({
  content,
  isUserMessage = false,
}: {
  content: string;
  isUserMessage?: boolean;
}) {
  // Create a ref to track the rendered content
  const contentRef = useRef<HTMLDivElement>(null);
  const [isContentTruncated, setIsContentTruncated] = useState(false);

  // IMPORTANT: Don't use useControls for content at all - it truncates the text!
  // Only use it for styling options
  const store = useCreateStore();
  const markdownOptions = useControls(
    {
      variant: {
        options: ["normal", "chat"] as const,
        value: "chat" as const,
      },
    },
    { store }
  );

  // Check if the content is being truncated
  useEffect(() => {
    if (contentRef.current) {
      const element = contentRef.current;
      // Check if text is being clipped (scrollWidth > clientWidth indicates overflow)
      const isTruncated =
        element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight;

      if (isTruncated !== isContentTruncated) {
        setIsContentTruncated(isTruncated);
      }
    }
  }, [isContentTruncated]);

  // Define comprehensive markdown options to ensure proper rendering
  const markdownComponentProps: MarkdownProps = {
    className: "markdown w-full overflow-hidden break-words",
    fullFeaturedCodeBlock: true,
    fontSize: 16,
    lineHeight: 1.75,
    variant: markdownOptions.variant,
    children: content, // Use original content without preprocessing
    allowHtml: true,
    componentProps: {
      a: {
        rel: "noopener noreferrer",
        target: "_blank",
      },
      highlight: {
        className: "text-base leading-7 text-foreground",
        copyButtonSize: "large",
      },
      img: {
        className: "w-full h-auto max-w-3xl",
      },
    },
    components: {
      a: ({ href, children, className }: any) => (
        <LinkPreview className={className} url={href}>
          {children}
        </LinkPreview>
      ),
      h1: ({ children }: any) => (
        <h1
          style={{
            fontSize: "2em",
            fontWeight: "700",
            lineHeight: "40px",
            marginBottom: "2rem",
          }}
        >
          {children}
        </h1>
      ),
      h2: ({ children }: any) => (
        <h2
          style={{
            fontSize: "1.5em",
            fontWeight: "600",
            lineHeight: "32px",
            marginTop: "2rem",
            marginBottom: "1rem",
          }}
        >
          {children}
        </h2>
      ),
      h3: ({ children }: any) => (
        <h3
          style={{
            fontSize: "1.25em",
            fontWeight: "600",
            lineHeight: "32px",
            marginTop: "1rem",
            marginBottom: "0.5rem",
          }}
        >
          {children}
        </h3>
      ),
      h4: ({ children }: any) => (
        <h4
          style={{
            fontSize: "1em",
            fontWeight: "600",
            lineHeight: "24px",
            marginTop: "1rem",
            marginBottom: "0.5rem",
          }}
        >
          {children}
        </h4>
      ),
      h5: ({ children }: any) => (
        <h5
          style={{
            fontSize: "1em",
            fontWeight: "600",
            lineHeight: "28px",
          }}
        >
          {children}
        </h5>
      ),
      p: ({ children }: any) => (
        <p
          className={cn(
            "whitespace-normal break-words",
            isUserMessage && "leading-6",
            !isUserMessage && "my-2 leading-7"
          )}
        >
          {children}
        </p>
      ),
      ul: ({ children }: any) => (
        <ul className="list-disc pl-6 my-3 space-y-1.5">{children}</ul>
      ),
      ol: ({ children }: any) => (
        <ol className="list-decimal pl-6 my-3 space-y-1.5">{children}</ol>
      ),
      li: ({ children }: any) => <li className="my-1 pl-1.5">{children}</li>,
      blockquote: ({ children }: any) => (
        <blockquote className="border-l-4 border-muted pl-4 italic my-3">
          {children}
        </blockquote>
      ),
      strong: ({ children }: any) => (
        <strong className="font-semibold">{children}</strong>
      ),
    },
  };

  // Create the markdown component with proper styling
  return (
    <div
      ref={contentRef}
      className="w-full overflow-visible markdown-container whitespace-pre-line"
      data-content-length={content.length}
    >
      {/* Use the Markdown component directly with our comprehensive props */}
      <Markdown {...markdownComponentProps} />
    </div>
  );
}

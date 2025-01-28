import { Markdown, MarkdownProps } from "@lobehub/ui";
import { useControls, useCreateStore } from "@lobehub/ui/storybook";
import { LinkPreview } from "./ui/link-preview";
import { cn } from "@/lib/utils";

export default function ChatMarkdown({ content }: { content: string }) {
  const store = useCreateStore();
  const options: MarkdownProps | any = useControls(
    {
      children: {
        rows: true,
        value: content,
      },
      variant: {
        options: ["normal", "chat"],
        value: "chat",
      },
    },
    { store }
  );

  return (
    <Markdown
      className="markdown max-w-[712px] overflow-x-hidden"
      fullFeaturedCodeBlock={true}
      fontSize={16}
      lineHeight={1.75}
      componentProps={{
        a: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
        mermaid: {
          className: "text-base leading-7 text-background",
        },
        highlight: {
          className: "text-base leading-7 text-foreground",
          spotlight: true,
          copyButtonSize: "large",
        },
        li: {
          className: "text-foreground marker:text-foreground",
        },
        img: {
          className: "w-full h-auto max-w-3xl",
        },
      }}
      components={{
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
      }}
      {...options}
    />
  );
}

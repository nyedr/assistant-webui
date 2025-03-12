import { cn } from "@/lib/utils";

interface AnimatedGradientTextProps {
  text: string;
  className?: string;
}

export default function AnimatedGradientText({
  text,
  className,
}: AnimatedGradientTextProps) {
  return (
    <span
      className={cn(
        "inline-flex animate-text-gradient bg-gradient-to-r from-[#ACACAC] via-[#363636] to-[#ACACAC] bg-[200%_auto] text-xl text-start text-transparent font-medium bg-clip-text",
        className
      )}
    >
      {text}
    </span>
  );
}

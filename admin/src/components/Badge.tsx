interface BadgeProps {
  label: string;
  color?: "blue" | "green" | "red" | "gray" | "purple" | "yellow";
}

const colorClass: Record<string, string> = {
  blue: "badge-blue",
  green: "badge-green",
  red: "badge-red",
  gray: "badge-gray",
  purple: "badge-purple",
  yellow: "badge-yellow",
};

export function Badge(props: BadgeProps) {
  return (
    <span class={colorClass[props.color ?? "gray"]}>
      {props.label}
    </span>
  );
}

// Shared avatar: image if present, else a colored initial. Sizes are full
// literal Tailwind classes (runtime-built class names wouldn't be generated).
const SIZES = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-12 h-12 text-base" };

export default function Avatar({ user, size = "md" }) {
  const cls = `${SIZES[size]} rounded-full object-cover shrink-0`;
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cls} />
  ) : (
    <span className={`${cls} bg-brand-900 flex items-center justify-center font-bold text-brand-200`}>
      {user?.name?.[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

import { getAvatar } from "@/lib/avatars";
import { cn } from "@/lib/cn";

/**
 * A member's avatar.
 *
 * Never renders a photograph directly from a URL: private child photos are
 * served only through an authorised route, and this component takes a resolved
 * `photoUrl` that the server has already decided the viewer may see. Passing
 * nothing gives the chosen avatar, which is the default and the norm.
 */
export function MemberAvatar({
  avatarKey,
  photoUrl,
  name,
  size = 56,
  className,
}: {
  avatarKey: string | null | undefined;
  photoUrl?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authorised route, not a static asset
      <img
        src={photoUrl}
        alt={`Photo of ${name}`}
        width={size}
        height={size}
        className={cn("rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const avatar = getAvatar(avatarKey);

  return (
    <span
      role="img"
      aria-label={`${avatar.label} avatar`}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: avatar.color,
        fontSize: size * 0.55,
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{avatar.glyph}</span>
    </span>
  );
}

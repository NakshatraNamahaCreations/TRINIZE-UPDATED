/**
 * Full-colour 3D icon from Microsoft's Fluent emoji set (MIT licence), bundled in public/icons3d.
 * Decorative by default — the text next to it carries the meaning.
 */
export function Icon3D({ name, size = 28, className = '', style, label }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icons3d/${name}.png`}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : 'true'}
      draggable="false"
      decoding="async"
      className={('i3d ' + className).trim()}
      style={style}
    />
  );
}

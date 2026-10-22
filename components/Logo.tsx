/** Al Liwan logo, swapping to a light version on dark backgrounds. */
export default function Logo({ height = 40, onDark = false }: { height?: number; onDark?: boolean }) {
  const width = Math.round((height * 1540) / 674);
  if (onDark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/alliwan-logo-white.png" alt="Al Liwan" width={width} height={height} style={{ display: "block" }} />;
  }
  return (
    <picture>
      <source srcSet="/alliwan-logo-dark.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/alliwan-logo.png" alt="Al Liwan" width={width} height={height} style={{ display: "block" }} />
    </picture>
  );
}

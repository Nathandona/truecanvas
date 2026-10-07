export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

export function brand() {
  return { name: process.env.BRAND_NAME || "Design review", logo: process.env.BRAND_LOGO || null };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

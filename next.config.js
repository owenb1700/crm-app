const nextConfig = {
  reactStrictMode: true,
  // Development only: lets phones and tablets on the same Wi-Fi open the
  // staging server by this Mac's local network address. Next.js blocks
  // its dev scripts for any host not listed here, which leaves the page
  // visible but unresponsive. Has no effect on the live (production) site.
  allowedDevOrigins: ["10.10.10.177", "*.local"]
};

module.exports = nextConfig;

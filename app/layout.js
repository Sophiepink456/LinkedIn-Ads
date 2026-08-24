export const metadata = {
  title: "Elevation Ad Generator",
  description: "Generate on-brand vacancy ads.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#f4f6f8",
          color: "#1b1f24",
        }}
      >
        {children}
      </body>
    </html>
  );
}

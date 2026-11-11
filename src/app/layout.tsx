import type { Metadata } from "next";
import localFont from "next/font/local";
import "@xyflow/react/dist/base.css";
import "./globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "영상제작",
  description: "숏츠·CF 장면과 영상을 캔버스에서 잇고 생성합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}

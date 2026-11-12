import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 시험 서버가 사용자 개발 서버와 부딪히지 않도록 시험 때만 작업 폴더를 나눈다
  distDir: process.env.VIDEOCREATE_DIST_DIR || ".next",
  // 칸 상태와 결과는 파일에서 항상 새로 읽어야 해서 cacheComponents 는 켜지 않는다.
  // 화면 구석의 개발 표시도 끈다. 사용자가 보는 화면이 곧 이 프로그램이다.
  devIndicators: false,
  // 온라인 보기 전용 판은 기록 사본(online-data/)을 함께 실어야 읽을 수 있다. 이 PC에서 쓸 때는 영향이 없다
  outputFileTracingIncludes: { "/*": ["./online-data/**/*"] },
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  turbopack: {
    // 집 폴더에 다른 package-lock.json 이 있어 작업 위치를 직접 알려 준다
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

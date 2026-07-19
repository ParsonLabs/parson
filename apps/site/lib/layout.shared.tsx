import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      enabled: false,
      title: <span className="parson-doc-nav-title">Documentation</span>,
      transparentMode: "top",
    },
    themeSwitch: { enabled: false },
  };
}

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

test("outline actions use the shared raised surface", () => {
  const markup = renderToStaticMarkup(
    <Button variant="outline">Secondary action</Button>,
  );

  expect(markup).toContain("rounded-md");
  expect(markup).toContain("bg-zinc-800");
  expect(markup).not.toContain("bg-black");
});

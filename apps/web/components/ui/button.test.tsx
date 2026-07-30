import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

test("default actions use the shared white primary style", () => {
  const markup = renderToStaticMarkup(<Button>Primary action</Button>);

  expect(markup).toContain("bg-white");
  expect(markup).toContain("text-black");
  expect(markup).toContain("hover:bg-zinc-200");
});

test("outline actions use the shared raised surface", () => {
  const markup = renderToStaticMarkup(
    <Button variant="outline">Secondary action</Button>,
  );

  expect(markup).toContain("rounded-md");
  expect(markup).toContain("bg-zinc-800");
  expect(markup).not.toContain("bg-black");
});

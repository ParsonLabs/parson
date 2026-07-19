import { source } from "./source";

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed");
  return `# ${page.data.title}\n\nSource: ${page.url}\n\n${processed}`;
}

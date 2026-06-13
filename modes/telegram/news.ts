import Firecrawl from "@mendable/firecrawl-js";
import { URL } from "node:url";

type SearchItem = {
  title?: string;
  url?: string;
  snippet?: string;
};

type ScrapedItem = SearchItem & {
  content?: string;
};

type NewsDigest = {
  title: string;
  body: string;
};

type SourceProfile = {
  name: string;
  domain: string;
  category: string;
  query: string;
};

type NewsItem = {
  title: string;
  date: string;
  category: string;
  summary: string;
  impact: string[];
  source: string;
};

const SOURCE_PROFILES: SourceProfile[] = [
  {
    name: "The Verge",
    domain: "theverge.com",
    category: "General Tech News",
    query: "latest tech news",
  },
  {
    name: "DeepMind Blog",
    domain: "deepmind.google",
    category: "AI-Focused News",
    query: "latest AI research blog",
  },
  {
    name: "TechCrunch",
    domain: "techcrunch.com",
    category: "General Tech News",
    query: "latest startup and AI news",
  },
  {
    name: "Reuters Technology",
    domain: "reuters.com",
    category: "Business & Startup News",
    query: "technology latest news",
  },
  {
    name: "MIT Technology Review",
    domain: "technologyreview.com",
    category: "AI-Focused News",
    query: "latest AI and technology news",
  },
  {
    name: "NVIDIA Newsroom",
    domain: "nvidianews.nvidia.com",
    category: "Big Tech Official Sources",
    query: "latest newsroom and AI news",
  },
  {
    name: "Hacker News",
    domain: "news.ycombinator.com",
    category: "Developer & Programming News",
    query: "top technology stories",
  },
];

let client: Firecrawl | null = null;

function getClient(): Firecrawl {
  if (client) return client;
  client = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });
  return client;
}

function clip(text: string, max = 3900): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\*_`~]/g, "")
    .trim();
}

function escapeJsonString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, '\\"')
    .replace(/\n/g, " ")
    .trim();
}

function extractReadableParagraphs(markdown: string): string[] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^\|/.test(line))
    .filter((line) => !/^[-*+]\s+$/.test(line))
    .filter((line) => !/^```/.test(line));

  const boilerplate = [
    /skip to main content/i,
    /subscribe/i,
    /sign in/i,
    /sign up/i,
    /notifications?/i,
    /hamburger navigation/i,
    /search/i,
    /read more/i,
    /learn more/i,
    /followfollow/i,
    /your browser does not support/i,
    /footer/i,
    /menu/i,
    /home/i,
  ];

  const paragraphs: string[] = [];
  let current = "";

  for (const line of lines) {
    const stripped = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .trim();

    if (!stripped || boilerplate.some((pattern) => pattern.test(stripped))) {
      if (current) {
        paragraphs.push(current.trim());
        current = "";
      }
      continue;
    }

    if (stripped.length < 80) {
      if (current) {
        paragraphs.push(current.trim());
        current = "";
      }
      continue;
    }

    if (current.length + stripped.length > 500) {
      paragraphs.push(current.trim());
      current = stripped;
    } else {
      current = current ? `${current} ${stripped}` : stripped;
    }
  }

  if (current) paragraphs.push(current.trim());
  return paragraphs
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 120)
    .filter((paragraph, index, list) => list.indexOf(paragraph) === index);
}

async function searchTechNews(query: string, limit: number): Promise<SearchItem[]> {
  const res = await getClient().search(query, {
    limit,
    sources: ["web"],
  });

  return ((res.web ?? []) as SearchItem[]).slice(0, limit);
}

function sourceName(rawUrl?: string): string {
  if (!rawUrl) return "web";
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function matchesProfile(url: string | undefined, domain: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isLikelyArticleUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "") return false;
    if (pathname === "/") return false;

    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return false;

    if (/^\d{4}$/.test(segments[0] ?? "")) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(segments[0] ?? "")) return true;
    if (segments.length >= 2 && /[a-z0-9]/i.test(segments[segments.length - 1] ?? "")) return true;

    return false;
  } catch {
    return false;
  }
}

async function scrapeArticle(item: SearchItem): Promise<ScrapedItem> {
  if (!item.url) return item;

  try {
    const doc = await getClient().scrape(item.url, { formats: ["markdown"] });
    const markdown = (doc as { markdown?: string }).markdown ?? "";
    const readable = extractReadableParagraphs(markdown);
    return {
      ...item,
      content: readable.join("\n\n"),
    };
  } catch {
    return item;
  }
}

async function fetchFromSource(profile: SourceProfile): Promise<SearchItem | null> {
  const queries = [
    `site:${profile.domain} ${profile.query}`,
    `site:${profile.domain} latest`,
    `site:${profile.domain} technology`,
  ];

  for (const query of queries) {
    const results = await searchTechNews(query, 10);
    const match = results.find((result) => matchesProfile(result.url, profile.domain) && isLikelyArticleUrl(result.url));
    if (match) return match;
  }

  return null;
}

function buildImpact(summary: string): string[] {
  const lower = summary.toLowerCase();
  const impact = new Set<string>();

  if (/ai|llm|model|agent/.test(lower)) impact.add("AI adoption and automation are accelerating");
  if (/security|privacy|vulnerability|breach/.test(lower)) impact.add("Security and compliance remain important");
  if (/startup|funding|venture|revenue/.test(lower)) impact.add("Startup and enterprise demand is changing fast");
  if (/developer|api|open source|sdk/.test(lower)) impact.add("Developer tooling and integrations are expanding");
  if (/chip|nvidia|gpu|hardware|device/.test(lower)) impact.add("Hardware and infrastructure still influence product strategy");

  return [...impact].slice(0, 3);
}

function summarizeNewsItem(item: ScrapedItem, profile: SourceProfile, date: string): NewsItem {
  const title = cleanText(item.title?.trim() || profile.name);
  const articleText = cleanText(item.content?.trim() || "");
  const snippetText = cleanText(item.snippet?.trim() || "");
  const summaryText = articleText || snippetText || "No readable article text found.";
  const summary = summaryText.length > 260 ? `${summaryText.slice(0, 260).trim()}...` : summaryText;

  return {
    title,
    date,
    category: profile.category,
    summary,
    impact: buildImpact(summary),
    source: profile.name,
  };
}

function formatNewsItemAsJson(item: NewsItem): string {
  return [
    "{",
    `  \"title\": \"${escapeJsonString(item.title)}\",`,
    `  \"date\": \"${escapeJsonString(item.date)}\",`,
    `  \"category\": \"${escapeJsonString(item.category)}\",`,
    `  \"summary\": \"${escapeJsonString(item.summary)}\",`,
    `  \"impact\": [${item.impact.map((line) => `\"${escapeJsonString(line)}\"`).join(", ")}],`,
    `  \"source\": \"${escapeJsonString(item.source)}\"`,
    "}",
  ].join("\n");
}

function formatNewsItemAsBrief(item: NewsItem, index: number): string {
  const impactLines = item.impact.length
    ? item.impact.map((line) => `- ${line}`).join("\n")
    : "- No major impact signals detected.";

  return [
    `${index + 1}. ${item.title}`,
    "",
    `Source: ${item.source}`,
    `Category: ${item.category}`,
    "",
    "Summary:",
    item.summary,
    "",
    "Why it matters:",
    impactLines,
  ].join("\n");
}

function summarizeContent(item: ScrapedItem): string {
  const title = cleanText(item.title?.trim() || "Untitled article");
  const source = sourceName(item.url);
  const readableParagraphs = item.content ? extractReadableParagraphs(item.content) : [];
  const content = cleanText(item.snippet?.trim() || "");
  const summaryParts = readableParagraphs.length
    ? readableParagraphs.slice(0, 3)
    : content
      ? [content]
      : ["No readable article text found."];

  const summary = summaryParts.join(" ");
  return `${title} (${source})\n${summary}`;
}

export async function buildTechNewsDigest(): Promise<NewsDigest> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is required for news scraping.");
  }

  const date = new Date().toISOString().slice(0, 10);
  const selectedSources = SOURCE_PROFILES;
  const items = await Promise.all(
    selectedSources.map(async (profile) => {
      const match = await fetchFromSource(profile);
      if (!match) {
        return summarizeNewsItem(
          {
            title: profile.name,
            snippet: `No fresh article could be fetched from ${profile.name} right now.`,
          },
          profile,
          date,
        );
      }

      const scraped = await scrapeArticle(match);
      return summarizeNewsItem(scraped, profile, date);
    }),
  );

  const briefBlock = items.map((item, index) => formatNewsItemAsBrief(item, index)).join("\n\n---\n\n");

  const body = [
    `Top Tech News (${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })})`,
    "",
    briefBlock,
  ].join("\n");

  return {
    title: "Latest Tech News",
    body: clip(body),
  };
}

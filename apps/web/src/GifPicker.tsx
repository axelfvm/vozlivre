import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type GifSelection = {
  provider: "GIPHY";
  externalId: string;
  url: string;
  title: string;
  altText: string;
  username: string | null;
  pageUrl: string | null;
};

type GiphyRendition = {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
};

type GiphyResult = {
  id: string;
  title?: string;
  alt_text?: string;
  username?: string;
  url?: string;
  user?: { display_name?: string; username?: string };
  images?: {
    fixed_width?: GiphyRendition;
    downsized?: GiphyRendition;
    original?: GiphyRendition;
  };
  analytics?: {
    onload?: { url?: string };
    onclick?: { url?: string };
    onsent?: { url?: string };
  };
};

type PickerItem = {
  id: string;
  title: string;
  altText: string;
  username: string | null;
  pageUrl: string | null;
  previewUrl: string;
  mediaUrl: string;
  width: number;
  height: number;
  loadAnalyticsUrl?: string;
  clickAnalyticsUrl?: string;
  sentAnalyticsUrl?: string;
};

const apiKey = import.meta.env.VITE_GIPHY_API_KEY?.trim() ?? "";
const configured = Boolean(apiKey && !apiKey.startsWith("CHANGE_ME"));

function ping(url?: string) {
  if (!url?.startsWith("https://giphy-analytics.giphy.com/")) return;
  void fetch(url, { cache: "no-store", mode: "no-cors", keepalive: true });
}

function toPickerItem(result: GiphyResult): PickerItem | null {
  const preview = result.images?.fixed_width;
  const original = result.images?.original;
  const previewUrl = preview?.webp || preview?.url;
  const mediaUrl = original?.webp || original?.url || result.images?.downsized?.url;
  if (!result.id || !previewUrl || !mediaUrl) return null;
  const title = result.title?.trim() || "GIF do GIPHY";
  const username =
    result.user?.display_name?.trim() ||
    result.user?.username?.trim() ||
    result.username?.trim() ||
    null;
  return {
    id: result.id,
    title,
    altText: result.alt_text?.trim() || title,
    username,
    pageUrl: result.url || null,
    previewUrl,
    mediaUrl,
    width: Number(preview?.width) || 200,
    height: Number(preview?.height) || 150,
    loadAnalyticsUrl: result.analytics?.onload?.url,
    clickAnalyticsUrl: result.analytics?.onclick?.url,
    sentAnalyticsUrl: result.analytics?.onsent?.url,
  };
}

export function GifPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (gif: GifSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const normalizedQuery = useMemo(() => query.trim().slice(0, 50), [query]);

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const endpoint = normalizedQuery
          ? "https://api.giphy.com/v1/gifs/search"
          : "https://api.giphy.com/v1/gifs/trending";
        const url = new URL(endpoint);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("limit", "24");
        url.searchParams.set("rating", "pg-13");
        if (normalizedQuery) {
          url.searchParams.set("q", normalizedQuery);
          url.searchParams.set("lang", "pt");
          url.searchParams.set("offset", "0");
        }
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: GiphyResult[];
          meta?: { msg?: string };
        };
        if (!response.ok)
          throw new Error(payload.meta?.msg || "A busca de GIFs falhou.");
        setResults(
          (payload.data ?? [])
            .map(toPickerItem)
            .filter((item): item is PickerItem => item !== null),
        );
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setResults([]);
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível carregar os GIFs.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, normalizedQuery ? 350 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  return (
    <section className="gif-picker" aria-label="Selecionar GIF">
      <header>
        <label>
          <Search size={16} />
          <input
            autoFocus
            value={query}
            maxLength={50}
            placeholder="Buscar GIFs"
            aria-label="Buscar GIFs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" aria-label="Fechar GIFs" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      {!configured ? (
        <div className="gif-picker__status">
          <strong>Integração GIPHY não configurada</strong>
          <span>
            Defina <code>VITE_GIPHY_API_KEY</code> no arquivo <code>.env</code>.
          </span>
        </div>
      ) : loading ? (
        <div className="gif-picker__status">Carregando GIFs…</div>
      ) : error ? (
        <div className="gif-picker__status gif-picker__status--error">{error}</div>
      ) : results.length === 0 ? (
        <div className="gif-picker__status">Nenhum GIF encontrado.</div>
      ) : (
        <div className="gif-picker__grid">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.title}
              style={{ aspectRatio: `${item.width} / ${item.height}` }}
              onClick={() => {
                ping(item.clickAnalyticsUrl);
                ping(item.sentAnalyticsUrl);
                onSelect({
                  provider: "GIPHY",
                  externalId: item.id,
                  url: item.mediaUrl,
                  title: item.title,
                  altText: item.altText,
                  username: item.username,
                  pageUrl: item.pageUrl,
                });
              }}
            >
              <img
                src={item.previewUrl}
                alt={item.altText}
                loading="lazy"
                onLoad={() => ping(item.loadAnalyticsUrl)}
              />
              {item.username && <span>{item.username}</span>}
            </button>
          ))}
        </div>
      )}

      <a
        className="gif-picker__attribution"
        href="https://giphy.com/"
        target="_blank"
        rel="noreferrer"
        aria-label="GIFs fornecidos pelo GIPHY"
      >
        <img src="/powered-by-giphy.png" alt="Powered by GIPHY" />
      </a>
    </section>
  );
}

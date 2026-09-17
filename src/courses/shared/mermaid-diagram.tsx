import { useEffect, useId, useState } from "react";

export type Theme = "dark" | "light";

export function MermaidDiagram({ chart, theme }: { chart: string; theme: Theme }) {
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError(false);
    void import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: theme === "dark" ? {
          background: "#20212a", primaryColor: "#302b4c", primaryTextColor: "#fbfaff", primaryBorderColor: "#b9b0f3",
          secondaryColor: "#26243b", secondaryTextColor: "#fbfaff", secondaryBorderColor: "#9288d5",
          tertiaryColor: "#1d1e27", tertiaryTextColor: "#f5f4fa", tertiaryBorderColor: "#5b5870",
          lineColor: "#d1cbed", edgeLabelBackground: "#20212a", clusterBkg: "#25243a", clusterBorder: "#77708f", fontFamily: "Montserrat, sans-serif",
        } : {
          background: "#ffffff", primaryColor: "#eeeafb", primaryTextColor: "#302c42", primaryBorderColor: "#766cad",
          secondaryColor: "#f6f4fd", secondaryTextColor: "#302c42", secondaryBorderColor: "#a9a1ce",
          tertiaryColor: "#f3f2f7", tertiaryTextColor: "#302c42", tertiaryBorderColor: "#bdbac9",
          lineColor: "#5d5775", edgeLabelBackground: "#ffffff", clusterBkg: "#f2effb", clusterBorder: "#b7b1d3", fontFamily: "Montserrat, sans-serif",
        },
        securityLevel: "strict",
        flowchart: { htmlLabels: false, useMaxWidth: true, padding: 18 },
      });
      return mermaid.render(`course-diagram-${instanceId}`, chart);
    }).then(({ svg: renderedSvg }) => {
      if (!cancelled) setSvg(renderedSvg);
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => { cancelled = true; };
  }, [chart, instanceId, theme]);

  if (error) return <pre className="diagram-fallback">{chart}</pre>;
  return <div className="mermaid-diagram" aria-label="Diagrama explicativo" dangerouslySetInnerHTML={{ __html: svg }} />;
}

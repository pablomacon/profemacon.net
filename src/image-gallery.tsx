import { useEffect, useState } from "react";

export type GalleryImage = {
  src: string;
  alt: string;
  title: string;
  credit: string;
  sourceUrl: string;
};

export function ImageGallery({ images }: { images: GalleryImage[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeImage = activeIndex === null ? null : images[activeIndex];
  const visibleIndex = activeIndex ?? 0;
  const hasMultipleImages = images.length > 1;
  const close = () => setActiveIndex(null);
  const previous = () => setActiveIndex((index) => index === null ? null : (index - 1 + images.length) % images.length);
  const next = () => setActiveIndex((index) => index === null ? null : (index + 1) % images.length);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (hasMultipleImages && event.key === "ArrowLeft") previous();
      if (hasMultipleImages && event.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, hasMultipleImages, images.length]);

  return <>
    <section className="unit-figures" aria-label="Referencias visuales">
      {images.map((image, index) => <figure key={image.src}>
        <button className="gallery-thumbnail" onClick={() => setActiveIndex(index)} aria-label={`Ampliar imagen: ${image.title}`}>
          <img src={image.src} alt={image.alt} />
          <span aria-hidden="true">Ampliar</span>
        </button>
        <figcaption><strong>{image.title}</strong> {image.credit} · <a href={image.sourceUrl} target="_blank" rel="noreferrer">ver fuente</a></figcaption>
      </figure>)}
    </section>
    {activeImage && <div className="gallery-dialog" role="dialog" aria-modal="true" aria-label={`Vista ampliada: ${activeImage.title}`}>
      <button className="gallery-backdrop" onClick={close} aria-label="Cerrar visor" />
      <section className="gallery-panel">
        <div className="gallery-toolbar"><p>{visibleIndex + 1} / {images.length}</p><button className="gallery-close" onClick={close} aria-label="Cerrar visor">×</button></div>
        <div className="gallery-stage">
          {hasMultipleImages && <button className="gallery-arrow previous" onClick={previous} aria-label="Imagen anterior">‹</button>}
          <img src={activeImage.src} alt={activeImage.alt} />
          {hasMultipleImages && <button className="gallery-arrow next" onClick={next} aria-label="Imagen siguiente">›</button>}
        </div>
        <footer><strong>{activeImage.title}</strong><span>{activeImage.credit}</span></footer>
      </section>
    </div>}
  </>;
}

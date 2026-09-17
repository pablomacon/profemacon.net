export type LessonVideo = { id: string; title: string; description: string; youtubeId: string };

export function VideoEmbed({ video }: { video: LessonVideo }) {
  return <section className="video-lesson" aria-labelledby={`${video.id}-title`}>
    <div className="video-lesson-copy">
      <p className="eyebrow">Material audiovisual</p>
      <h3 id={`${video.id}-title`}>{video.title}</h3>
      <p>{video.description}</p>
      <a href={`https://www.youtube.com/watch?v=${video.youtubeId}`} target="_blank" rel="noreferrer">Abrir en YouTube ↗</a>
    </div>
    <div className="video-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`} title={video.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
  </section>;
}

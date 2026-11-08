// Read the gallery's loaded view records without opening a player or making requests.
export function readPageVideos() {
  const posts = document.querySelector("#app")?.__vue__?.$data?.blogs;
  const result = { pageUrl: location.href, videos: [] };
  if (!Array.isArray(posts)) return result;

  for (const post of posts) {
    if (post?.mode !== "VIEW" || post.act_type !== 0 || post.simulateFans || !Array.isArray(post.allMedia)) continue;
    const caption = post.is_translated && !post.show_original ? post.display_content || post.content : post.content;
    const videos = post.allMedia.filter((video) => video?.sourceType === 2 && typeof video.url_video === "string" && video.url_video.trim());
    for (const [index, video] of videos.entries()) {
      result.videos.push({
        url: video.url_video,
        title: typeof video.title === "string" ? video.title : "",
        caption: typeof caption === "string" ? caption : "",
        sequence: videos.length > 1 ? index + 1 : 0,
      });
    }
  }
  return result;
}

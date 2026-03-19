export const SITE = {
  website: "https://blog.yfapi.tech", // 先用Cloudflare给你的地址，后面再换成域名
  author: "Francisco",
  profile: "https://github.com/Francisco2333",
  desc: "Francisco 的个人博客",
  title: "Francisco Blog",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000,
  showArchives: true,
  showBackButton: true,

  editPost: {
    enabled: true,
    text: "Edit on GitHub",
    url: "https://github.com/你的用户名/AstroPages-Bilingual/edit/main/",
  },

  dynamicOgImage: true,
  dir: "ltr",
  lang: "zh", // 改成中文为主
  timezone: "Asia/Shanghai", // 改成中国
} as const;

export const BLOG_PATH = "src/data/blog";

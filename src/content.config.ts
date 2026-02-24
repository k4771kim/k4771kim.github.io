import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    thumbnail: image(),
    detailImage: image().optional(),
    galleryImages: z.array(image()).optional(),
    youtubeUrl: z.string().optional(),
    categories: z.array(z.string()),
    role: z.string(),
    links: z.array(z.object({
      label: z.string(),
      url: z.string(),
    })).default([]),
    year: z.number(),
    order: z.number(),
  }),
});

export const collections = { projects };

// 中文媒体信源的正文读取（环球网、参考消息），见 backend/body.ts。
import { defineServerModule } from "@aihot/backend/modules";
import { bodyFromPage } from "./backend/body.ts";

export default defineServerModule({ name: "cn-media", bodyFromPage });

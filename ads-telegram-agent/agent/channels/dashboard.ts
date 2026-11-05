import { defineChannel, GET, POST } from "eve/channels";
import { dashboardApi } from "../lib/dashboard-api.ts";

export default defineChannel({
  routes: [
    GET("/api/:operation", dashboardApi),
    POST("/api/:operation", dashboardApi),
  ],
});

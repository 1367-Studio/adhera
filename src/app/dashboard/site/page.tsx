import { redirect } from "next/navigation"

// The legacy editor (SiteView) is discontinued — nobody is sent here anymore, not even to
// revert to it. This route only still exists because old links/bookmarks may point at it;
// it immediately sends everyone to the new editor (whose own guard sends anyone without
// edit access on to "/dashboard").
export default function SitePage() {
  redirect("/dashboard/site/puck")
}

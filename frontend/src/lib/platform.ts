/*
  macOS draws the traffic lights over the top-left of the content, because the
  window uses a hidden title bar. The top row of the workbench leaves them room
  there only.
*/
export const IS_MAC = navigator.userAgent.includes("Mac")

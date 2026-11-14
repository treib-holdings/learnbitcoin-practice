"""Alerts to the operator's ntfy topic: once when something goes wrong, once when it recovers."""

import urllib.request


def ntfy(topic: str, title: str, message: str, priority: str = "default", tags: str = "warning") -> None:
    request = urllib.request.Request(
        f"https://ntfy.sh/{topic}",
        data=message.encode(),
        headers={"Title": title, "Priority": priority, "Tags": tags},
    )
    urllib.request.urlopen(request, timeout=15).read()


class Alerter:
    def __init__(self, topic: str, send=ntfy, log=print):
        self.topic = topic
        self.send = send
        self.log = log
        self.active: dict[str, str] = {}

    def update(self, problems: dict) -> list:
        """Send an alert for each new problem and a recovery note for each cleared one."""
        sent = []
        for name, message in problems.items():
            if message and name not in self.active:
                self.active[name] = message
                sent.append(self._send("practice-net problem", message, "high", "warning"))
            elif not message and name in self.active:
                cleared = self.active.pop(name)
                sent.append(self._send("practice-net recovered", f"Fixed: {cleared}", "low", "white_check_mark"))
        return sent

    def _send(self, title: str, message: str, priority: str, tags: str) -> str:
        self.log(f"alert: {title}: {message}")
        if self.topic:
            try:
                self.send(self.topic, title, message, priority, tags)
            except Exception as e:  # an alert that cannot be sent must not stop the bots
                self.log(f"alert not sent: {e}")
        return message

"""List-compatible source results with bounded traversal accounting."""

from contest_detective.server.research_pipeline.refresh.contracts import SourceInventory


class SourceBatch(list):
    def __init__(self, source, *args):
        super().__init__(*args)
        self.inventory = SourceInventory(source=source, termination='exhausted')

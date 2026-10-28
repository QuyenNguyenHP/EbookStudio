import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

import server


class ReaderDataTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.patch = patch.multiple(server, LIBRARY=root, READER_DATA=root / 'reader-data.json')
        self.patch.start()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.EbookStudioHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.patch.stop()
        self.directory.cleanup()

    def request(self, method, data=None):
        connection = HTTPConnection('127.0.0.1', self.http.server_port)
        connection.request(method, '/api/reader-data', json.dumps(data) if data is not None else None)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_save_reload_edit_delete_and_conflict(self):
        self.assertEqual(self.request('GET')[1], {'revision': 0, 'notes': [], 'words': []})
        data = {'revision': 0, 'notes': [{'id': 'n1', 'text': 'Ghi ch\u00fa', 'docId': 'pdf'}], 'words': [{'id': 'w1', 'text': 'book'}]}
        self.assertEqual(self.request('PUT', data), (200, {'revision': 1}))
        self.assertEqual(json.loads(server.READER_DATA.read_text(encoding='utf-8'))['notes'], data['notes'])
        self.assertEqual(self.request('PUT', data)[0], 409)
        data['revision'] = 1
        data['notes'][0]['text'] = 'Edited'
        data['words'] = []
        self.assertEqual(self.request('PUT', data)[0], 200)
        self.assertEqual(self.request('GET')[1]['notes'][0]['text'], 'Edited')
        self.assertEqual(self.request('GET')[1]['words'], [])

    def test_invalid_input_and_corruption_preserve_file(self):
        self.assertEqual(self.request('PUT', {'revision': 0, 'notes': {}, 'words': []})[0], 400)
        self.assertFalse(server.READER_DATA.exists())
        server.READER_DATA.write_text('broken', encoding='utf-8')
        self.assertEqual(self.request('GET')[0], 500)
        self.assertEqual(self.request('PUT', {'revision': 0, 'notes': [], 'words': []})[0], 400)
        self.assertEqual(server.READER_DATA.read_text(), 'broken')


if __name__ == '__main__':
    unittest.main()

/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*global define, $*/
/*unittests: FileTreeView*/

define(function (require, exports, module) {
    "use strict";
    
    var React = require("thirdparty/react"),
        _ = require("thirdparty/lodash"),
        FileUtils = require("file/FileUtils"),
        FileViewController = require("project/FileViewController");
    
    var DOM = React.DOM;
    
    /**
     * Name of the preferences for sorting directories first
     * 
     * @type {string}
     */
    var SORT_DIRECTORIES_FIRST = "sortDirectoriesFirst";
    
    function _formatDirectoryContents(contents) {
        return contents.map(function (entry) {
            if (entry.isFile) {
                var i = entry.name.lastIndexOf(".");
                return {
                    name: entry.name.substr(0, i > -1 ? i : entry.name.length),
                    extension: entry.name.substring(i)
                };
            } else {
                return {
                    name: entry.name,
                    children: null,
                    directory: entry
                };
            }
        });
    }
    
    function _nameCompare(a, b) {
        var result = FileUtils.compareFilenames(a.name, b.name, false);
        if (result === 0) {
            if (a.extension && b.extension === "") {
                return 1;
            } else if (b.extension && a.extension === "") {
                return -1;
            } else {
                return FileUtils.compareFilenames(a.extension, b.extension, false);
            }
        }
        return result;
    }
    
    function _dirsFirst(a, b) {
        if (a.children !== undefined && b.children === undefined) {
            return -1;
        }
    }
    
    function _sortFormattedDirectory(contents, dirsFirst) {
        return contents.sort(_nameCompare);
    }
    
    function ViewModel(projectRoot) {
        this.projectRoot = projectRoot;
        this.treeData = [];
        this.updateContents("");
    }
    
    /**
     * Reference to the currently selected file.
     * @type {?(File|Directory)}
     */
    ViewModel.prototype.selected = null;
    
    /**
     * Reference to previous selected file when ProjectManager had
     * selection focus from FileViewController.
     * @type {?(File|Directory)}
     */
    ViewModel.prototype.lastSelected = null;
    
    ViewModel.prototype.sortDirsFirst = false;
    
    ViewModel.prototype.treeData = null;
    
    ViewModel.prototype.updateContents = function updateContents(subpath) {
        
    };
    
    /**
     * @private
     * Save ProjectManager project path and tree state.
     */
    ViewModel.prototype._getOpenNodes = function _getOpenNodes() {

        var openNodes = [],
            projectPathLength = projectRoot.fullPath.length,
            entry,
            fullPath,
            shortPath,
            depth,
            context = { location : { scope: "user",
                                    layer: "project",
                                    layerID: projectRoot.fullPath } };

        // Query open nodes by class selector
        $(".jstree-open:visible").each(function (index) {
            entry = $(this).data("entry");

            if (entry.fullPath) {
                fullPath = entry.fullPath;

                // Truncate project path prefix (including its last slash) AND remove trailing slash suffix
                // So "/foo/bar/projroot/abc/xyz/" -> "abc/xyz"
                shortPath = fullPath.slice(projectPathLength, -1);

                // Determine depth of the node by counting path separators.
                // Children at the root have depth of zero
                depth = shortPath.split("/").length - 1;

                // Map tree depth to list of open nodes
                if (openNodes[depth] === undefined) {
                    openNodes[depth] = [];
                }

                openNodes[depth].push(fullPath);
            }
        });

        // Store the open nodes by their full path and persist to storage
        PreferencesManager.setViewState("project.treeState", openNodes, context);
    };
    
    /**
     * @private
     * Reopens a set of nodes in the tree by ID.
     * @param {Array.<Array.<string>>} nodesByDepth An array of arrays of node ids to reopen. The ids within
     *     each sub-array are reopened in parallel, and the sub-arrays are reopened in order, so they should
     *     be sorted by depth within the tree.
     * @param {$.Deferred} resultDeferred A Deferred that will be resolved when all nodes have been fully
     *     reopened.
     */
    ViewModel.prototype.reopenNodes = function reopenNodes(nodesByDepth, resultDeferred) {
        if (nodesByDepth.length === 0) {
            // All paths are opened and fully rendered.
            resultDeferred.resolve();
        } else {
            var toOpenPaths = nodesByDepth.shift(),
                toOpenIds   = [],
                node        = null;

            // use path to lookup ID
            toOpenPaths.forEach(function (value, index) {
                node = _projectInitialLoad.fullPathToIdMap[value];

                if (node) {
                    toOpenIds.push(node);
                }
            });

            Async.doInParallel(
                toOpenIds,
                function (id) {
                    var result = new $.Deferred();
                    _projectTree.jstree("open_node", "#" + id, function () {
                        result.resolve();
                    }, true);
                    return result.promise();
                },
                false
            ).always(function () {
                _reopenNodes(nodesByDepth, resultDeferred);
            });
        }
    };
    
    ViewModel.prototype.on = function (event, handler) {
        $(this).on(event, handler);
    };
    
    ViewModel.prototype.off = function (event, handler) {
        $(this).off(event, handler);
    };
    
    var openPaths = {},
        fileContext = null,
        rename = null,
        _renderTree;

    function _togglePath(path, open) {
        if (open) {
            openPaths[path] = true;
        } else {
            delete openPaths[path];
        }
        _renderTree();
    }

    function _setSelected(path) {
        fileContext = null;
        var openResult = FileViewController.openAndSelectDocument(path, FileViewController.PROJECT_MANAGER);

        openResult.done(function () {
            _renderTree();
        });
    }

    function _setContext(path) {
        fileContext = path;
        _renderTree();
    }

    function getContext() {
        return fileContext;
    }

    /**
     * @private
     */
    function _hasFileSelectionFocus() {
        return FileViewController.getFileSelectionFocus() === FileViewController.PROJECT_MANAGER;
    }
    
    var fileNode = React.createClass({
        handleClick: function (e) {
            console.log("file clicked", e, e.button);
            if (this.props.setSelected) {
                this.props.setSelected(this.props.file.fullPath);
            }
            return false;
        },
        handleMouseDown: function (e) {
            if (e.button === 2 && this.props.setContext) {
                this.props.setContext(this.props.file.fullPath);
            }
            return true;
        },
        render: function () {
            var entry = this.props.file,
                i = entry.name.lastIndexOf("."),
                name = entry.name.substr(0, i > -1 ? i : entry.name.length),
                extension;
            
            if (i > -1) {
                extension = DOM.span({
                    className: "extension"
                }, entry.name.substring(i));
            }
            
            var fileClasses = "";
            if (this.props.selected) {
                fileClasses = "jstree-clicked jstree-hovered sidebar-selection";
            }
            if (this.props.context) {
                fileClasses += " sidebar-context";
            }
            return DOM.li({
                className: "jstree-leaf",
                onClick: this.handleClick,
                onMouseDown: this.handleMouseDown
            },
                DOM.ins({
                    className: "jstree-icon"
                }, "&nbsp;"),
                DOM.a({
                    href: "#",
                    className: fileClasses
                }, name, extension));
        }
    });

    var fileRename = React.createClass({
        handleKeyDown: function (e) {
            if (e.keyCode === 27) {
                this.props.cancel();
            }
        },
        render: function () {
            return DOM.li({
                className: "jstree-leaf"
            },
                DOM.ins({
                    className: "jstree-icon"
                }, "&nbsp;"),
                DOM.input({
                    className: "sidebar-context jstree-clicked",
                    type: "text",
                    defaultValue: this.props.file.name,
                    autoFocus: true,
                    onKeyDown: this.handleKeyDown
                }));
        }
    });

    var directoryNode = React.createClass({
        getInitialState: function () {
            return {};
        },
        loadContents: function () {
            this.props.directory.getContents(function (err, contents) {
                if (!err) {
                    this.setState({
                        contents: contents
                    });
                }
            }.bind(this));
        },
        componentDidMount: function () {
            var open = this.props.open;
            if (open) {
                this.loadContents();
            }
        },
        handleClick: function () {
            if (this.props.togglePath) {
                var newOpen = !this.props.open;
                if (newOpen && !this.state.contents) {
                    this.loadContents();
                }
                this.props.togglePath(this.props.directory.fullPath, !this.props.open);
            }
            return false;
        },
        render: function () {
            var nodes;
            if (this.state.contents) {
                var dirsFirst = this.props.dirsFirst;
                nodes = _(this.state.contents).clone().sort(function (a, b) {
                    if (dirsFirst) {
                        if (a.isDirectory && !b.isDirectory) {
                            return -1;
                        } else if (!a.isDirectory && b.isDirectory) {
                            return 1;
                        }
                    }
                    return FileUtils.compareFilenames(a.name, b.name, false);
                }).map(function (entry) {
                    return this._formatEntry(entry);
                }.bind(this));
            } else {
                nodes = [];
            }
            
            if (this.props.skipRoot) {
                return DOM.div(null, nodes);
            }
            
            var open = this.props.open ? "open" : "closed";
            
            return DOM.li({
                className: "jstree-" + open,
                onClick: this.handleClick
            },
                DOM.ins({
                    className: "jstree-icon"
                }, "&nbsp;"),
                DOM.a({
                    href: "#"
                },
                    DOM.ins({
                        className: "jstree-icon"
                    }, "&nbsp;"),
                    this.props.directory.name),
                    DOM.ul(null, nodes));
        },
        
        _formatEntry: function (entry) {
            if (entry.isDirectory) {
                var open = !!this.props.openPaths[entry.fullPath];
                return directoryNode({
                    key: entry.fullPath,
                    open: open,
                    openPaths: this.props.openPaths,
                    selected: this.props.selected,
                    setSelected: this.props.setSelected,
                    context: this.props.context,
                    setContext: this.props.setContext,
                    rename: this.props.rename,
                    togglePath: this.props.togglePath,
                    directory: entry
                });
            } else {
                if (this.props.rename && this.props.context === entry.fullPath) {
                    return fileRename({
                        key: entry.fullPath,
                        cancel: this.props.rename.cancel,
                        file: entry
                    });
                }
                return fileNode({
                    key: entry.fullPath,
                    selected: this.props.selected === entry.fullPath,
                    setSelected: this.props.setSelected,
                    context: this.props.context === entry.fullPath,
                    setContext: this.props.setContext,
                    file: entry
                });
            }
        }
    });
    
    var fileTreeView = React.createClass({
        render: function () {
            return DOM.ul({
                className: "jstree-no-dots jstree-no-icons"
            },
                directoryNode({
                    key: this.props.root.fullPath,
                    directory: this.props.root,
                    open: true,
                    skipRoot: true,
                    selected: this.props.selected,
                    setSelected: this.props.setSelected,
                    context: this.props.context,
                    setContext: this.props.setContext,
                    rename: this.props.rename,
                    togglePath: this.props.togglePath,
                    openPaths: this.props.openPaths,
                    dirsFirst: this.props.dirsFirst
                }));
        }
        
    });
    
    function render(element, root, props) {
        $(element).addClass("jstree jstree-brackets");
        $(element).css("overflow", "auto");
        React.renderComponent(fileTreeView({
            root: root,
            openPaths: props.openPaths,
            selected: props.selected,
            togglePath: props.togglePath,
            setSelected: props.setSelected,
            setContext: props.setContext,
            context: props.context,
            rename: props.rename,
            dirsFirst: props.dirsFirst
        }),
            element);
    }
    
    function renameItemInline(entry) {
        rename = {
            path: entry,
            cancel: _cancelRename
        };
        fileContext = entry;
        _renderTree();
    }

    function _cancelRename() {
        fileContext = null;
        rename = null;
        _renderTree();
    }
    
    exports._formatDirectoryContents = _formatDirectoryContents;
    exports._sortFormattedDirectory = _sortFormattedDirectory;
    exports.render = render;
    exports.ViewModel = ViewModel;
});